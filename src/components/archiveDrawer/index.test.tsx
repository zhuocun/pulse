import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { store } from "../../store";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";

import ArchiveDrawer from ".";

jest.mock("../../utils/hooks/useIsPhoneChrome");

const mockedUseIsPhoneChrome = useIsPhoneChrome as jest.MockedFunction<
    typeof useIsPhoneChrome
>;

const PROJECT_ID = "project-1";

const task = (overrides: Partial<ITask> = {}): ITask => ({
    _id: "task-1",
    columnId: "column-1",
    coordinatorId: "member-1",
    // The default fixture is a genuinely ARCHIVED task — `archivedAt` set — so
    // it survives the drawer's only-archived filter (the live `GET` widens to
    // active + archived; the drawer drops rows whose `archivedAt` is unset).
    archivedAt: "2026-01-01T00:00:00.000Z",
    epic: "Feature",
    index: 0,
    note: "No note",
    projectId: PROJECT_ID,
    storyPoints: 3,
    taskName: "Archived task",
    type: "Bug",
    ...overrides
});

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

const renderDrawer = (
    {
        open = true,
        onClose = jest.fn(),
        projectId = PROJECT_ID
    }: {
        open?: boolean;
        onClose?: () => void;
        projectId?: string;
    } = {},
    seedArchived?: ITask[]
) => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    if (seedArchived) {
        queryClient.setQueryData(
            ["tasks", { projectId, includeArchived: true }],
            seedArchived
        );
    }
    const utils = render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <ArchiveDrawer
                        onClose={onClose}
                        open={open}
                        projectId={projectId}
                    />
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
    return { ...utils, queryClient };
};

describe("ArchiveDrawer", () => {
    const fetchMock = jest.spyOn(global, "fetch");

    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        mockedUseIsPhoneChrome.mockReturnValue(false);
        fetchMock.mockReset();
        // Default: archive list resolves empty unless a test overrides.
        fetchMock.mockResolvedValue(response([]));
    });

    afterAll(() => {
        fetchMock.mockRestore();
    });

    it("lists the project's seeded archived tasks with name + meta", async () => {
        renderDrawer({}, [
            task(),
            task({ _id: "task-2", taskName: "Another archived", type: "Task" })
        ]);

        expect(await screen.findByText("Archived task")).toBeInTheDocument();
        expect(screen.getByText("Another archived")).toBeInTheDocument();
        // Minimal meta (task type) renders alongside the name.
        expect(screen.getByText("Bug")).toBeInTheDocument();
        expect(screen.getAllByTestId("archive-drawer-row")).toHaveLength(2);
        expect(
            screen.queryByTestId("archive-drawer-empty")
        ).not.toBeInTheDocument();
    });

    it("filters OUT active rows the widened GET returns (only archivedAt-set tasks render)", async () => {
        // `GET /tasks?includeArchived=true` WIDENS the result to active +
        // archived (the flag opts archived rows IN, it does not scope the list
        // to only-archived), so the drawer MUST drop any row whose `archivedAt`
        // is unset — otherwise live board tasks would appear in the archive.
        // Seed an active task (archivedAt null) next to an archived one; only
        // the archived row may render.
        renderDrawer({}, [
            task({
                _id: "active-1",
                taskName: "Active board task",
                archivedAt: null
            }),
            task({ _id: "archived-1", taskName: "Genuinely archived" })
        ]);

        expect(
            await screen.findByText("Genuinely archived")
        ).toBeInTheDocument();
        expect(screen.queryByText("Active board task")).not.toBeInTheDocument();
        expect(screen.getAllByTestId("archive-drawer-row")).toHaveLength(1);
    });

    it("issues GET /tasks?projectId=…&includeArchived=true when opened", async () => {
        renderDrawer();

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const url = String(fetchMock.mock.calls[0][0]);
        expect(url).toContain("tasks");
        expect(url).toContain(`projectId=${PROJECT_ID}`);
        expect(url).toContain("includeArchived=true");
    });

    it("does not fetch while the drawer is closed", () => {
        renderDrawer({ open: false });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("shows an aria-busy loading body before empty or rows render", () => {
        fetchMock.mockImplementation(
            () => new Promise<Response>(() => undefined)
        );
        renderDrawer();

        expect(screen.getByTestId("archive-drawer-body")).toHaveAttribute(
            "aria-busy",
            "true"
        );
        expect(screen.getByTestId("archive-drawer-loading")).toHaveTextContent(
            "Loading archived tasks…"
        );
        expect(
            screen.queryByTestId("archive-drawer-empty")
        ).not.toBeInTheDocument();
        expect(
            screen.queryByTestId("archive-drawer-list")
        ).not.toBeInTheDocument();
    });

    it("renders the empty state when there are no archived tasks", async () => {
        renderDrawer({}, []);
        expect(
            await screen.findByTestId("archive-drawer-empty")
        ).toBeInTheDocument();
        expect(
            screen.queryByTestId("archive-drawer-row")
        ).not.toBeInTheDocument();
    });

    it("Unarchive fires PUT /tasks/archive with { _id, archived: false } and the row leaves the list", async () => {
        // First archive-list fetch returns the seeded task; after the unarchive
        // invalidates ["tasks"], the active archive query refetches and the
        // backend now reports an empty archive — so the row must disappear.
        let unarchived = false;
        fetchMock.mockImplementation((input, init) => {
            const url = String(input);
            const method = (init?.method ?? "GET").toString().toUpperCase();
            if (url.includes("tasks/archive") && method === "PUT") {
                unarchived = true;
                return Promise.resolve(response({ _id: "task-1" }));
            }
            // The archive list GET.
            return Promise.resolve(response(unarchived ? [] : [task()]));
        });

        renderDrawer({}, [task()]);

        const unarchiveButton = await screen.findByTestId(
            "archive-drawer-unarchive"
        );
        fireEvent.click(unarchiveButton);

        // The unarchive call carries the task _id + archived:false in the body.
        await waitFor(() => {
            const unarchiveCall = fetchMock.mock.calls.find(([url]) =>
                String(url).includes("tasks/archive")
            );
            expect(unarchiveCall).toBeDefined();
        });
        const unarchiveCall = fetchMock.mock.calls.find(([url]) =>
            String(url).includes("tasks/archive")
        );
        expect(String(unarchiveCall?.[0])).toContain("tasks/archive");
        expect(unarchiveCall?.[1]?.method).toBe("PUT");
        expect(unarchiveCall?.[1]?.body).toBe(
            JSON.stringify({ _id: "task-1", archived: false })
        );

        // The invalidation refetched the (now-empty) archive list, so the row
        // is gone and the empty state shows.
        await waitFor(() =>
            expect(
                screen.queryByTestId("archive-drawer-row")
            ).not.toBeInTheDocument()
        );
        expect(
            await screen.findByTestId("archive-drawer-empty")
        ).toBeInTheDocument();
    });

    it("Unarchive invalidates the ['tasks'] prefix so BOTH the board and archive lists refetch", async () => {
        const { queryClient } = renderDrawer({}, [task()]);
        // Seed the board's OWN list (a distinct key) so we can assert the
        // prefix invalidation reaches it too.
        act(() => {
            queryClient.setQueryData(
                ["tasks", { projectId: PROJECT_ID }],
                [task()]
            );
        });
        const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

        fireEvent.click(await screen.findByTestId("archive-drawer-unarchive"));

        await waitFor(() =>
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tasks"] })
        );
        // React Query partial-matches the prefix against both task queries.
        expect(
            queryClient
                .getQueryCache()
                .findAll({ queryKey: ["tasks"] })
                .map((q) => q.queryKey)
        ).toEqual(
            expect.arrayContaining([
                ["tasks", { projectId: PROJECT_ID }],
                ["tasks", { projectId: PROJECT_ID, includeArchived: true }]
            ])
        );
    });

    it("Delete permanently fires DELETE /tasks?taskId=…&purge=true after confirming", async () => {
        let purged = false;
        fetchMock.mockImplementation((input, init) => {
            const url = String(input);
            const method = (init?.method ?? "GET").toString().toUpperCase();
            if (url.includes("tasks") && method === "DELETE") {
                purged = true;
                return Promise.resolve(response({ ok: true }));
            }
            return Promise.resolve(response(purged ? [] : [task()]));
        });

        renderDrawer({}, [task()]);

        fireEvent.click(await screen.findByTestId("archive-drawer-purge"));
        // Confirm the Popconfirm (destructive ok button).
        fireEvent.click(
            await screen.findByRole("button", {
                name: /Delete permanently/i
            })
        );

        await waitFor(() => {
            const deleteCall = fetchMock.mock.calls.find(
                ([url, init]) =>
                    String(url).includes("tasks") &&
                    (init?.method ?? "GET").toString().toUpperCase() ===
                        "DELETE"
            );
            expect(deleteCall).toBeDefined();
        });
        const deleteCall = fetchMock.mock.calls.find(
            ([url, init]) =>
                String(url).includes("tasks") &&
                (init?.method ?? "GET").toString().toUpperCase() === "DELETE"
        );
        const deleteUrl = String(deleteCall?.[0]);
        expect(deleteUrl).toContain("taskId=task-1");
        expect(deleteUrl).toContain("purge=true");
        // The purged row leaves the list once the prefix invalidation
        // refetches the (now-empty) archive.
        await waitFor(() =>
            expect(
                screen.queryByTestId("archive-drawer-row")
            ).not.toBeInTheDocument()
        );
    });

    it("exposes per-row aria-labels carrying the task name", async () => {
        renderDrawer({}, [task({ taskName: "Recover me" })]);

        expect(
            await screen.findByRole("button", {
                name: /Unarchive task “Recover me”/i
            })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", {
                name: /Permanently delete task “Recover me”/i
            })
        ).toBeInTheDocument();
    });

    it("renders as a multi-detent Sheet on phone chrome", async () => {
        mockedUseIsPhoneChrome.mockReturnValue(true);
        renderDrawer({}, [task()]);

        expect(screen.getByTestId("archive-drawer")).toBeInTheDocument();
        const surface = screen.getByTestId("archive-drawer-surface");
        expect(surface).toBeInTheDocument();
        expect(surface).toHaveAttribute("data-detent", "medium");
        expect(
            screen.getByTestId("archive-drawer-grabber")
        ).toBeInTheDocument();
        // The seeded row still renders inside the Sheet body.
        expect(await screen.findByText("Archived task")).toBeInTheDocument();
    });
});
