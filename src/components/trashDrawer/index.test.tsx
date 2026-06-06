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

import TrashDrawer from ".";

jest.mock("../../utils/hooks/useIsPhoneChrome");

const mockedUseIsPhoneChrome = useIsPhoneChrome as jest.MockedFunction<
    typeof useIsPhoneChrome
>;

const PROJECT_ID = "project-1";

const task = (overrides: Partial<ITask> = {}): ITask => ({
    _id: "task-1",
    columnId: "column-1",
    coordinatorId: "member-1",
    // The default fixture is a genuinely TRASHED task — `deletedAt` set — so
    // it survives the drawer's only-trashed filter (the live `GET` widens to
    // active + trashed; the drawer drops rows whose `deletedAt` is unset).
    deletedAt: "2026-01-01T00:00:00.000Z",
    epic: "Feature",
    index: 0,
    note: "No note",
    projectId: PROJECT_ID,
    storyPoints: 3,
    taskName: "Trashed task",
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
    seedTrashed?: ITask[]
) => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });
    if (seedTrashed) {
        queryClient.setQueryData(
            ["tasks", { projectId, includeTrashed: true }],
            seedTrashed
        );
    }
    const utils = render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <TrashDrawer
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

describe("TrashDrawer", () => {
    const fetchMock = jest.spyOn(global, "fetch");

    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        mockedUseIsPhoneChrome.mockReturnValue(false);
        fetchMock.mockReset();
        // Default: trash list resolves empty unless a test overrides.
        fetchMock.mockResolvedValue(response([]));
    });

    afterAll(() => {
        fetchMock.mockRestore();
    });

    it("lists the project's seeded trashed tasks with name + meta", async () => {
        renderDrawer({}, [
            task(),
            task({ _id: "task-2", taskName: "Another trashed", type: "Task" })
        ]);

        expect(await screen.findByText("Trashed task")).toBeInTheDocument();
        expect(screen.getByText("Another trashed")).toBeInTheDocument();
        // Minimal meta (task type) renders alongside the name.
        expect(screen.getByText("Bug")).toBeInTheDocument();
        expect(screen.getAllByTestId("trash-drawer-row")).toHaveLength(2);
        expect(
            screen.queryByTestId("trash-drawer-empty")
        ).not.toBeInTheDocument();
    });

    it("filters OUT active rows the widened GET returns (only deletedAt-set tasks render)", async () => {
        // `GET /tasks?includeTrashed=true` WIDENS the result to active +
        // trashed (the flag opts trashed rows IN, it does not scope the list to
        // only-trashed), so the drawer MUST drop any row whose `deletedAt` is
        // unset — otherwise live board tasks would appear in the trash. Seed an
        // active task (deletedAt null) next to a trashed one; only the trashed
        // row may render.
        renderDrawer({}, [
            task({
                _id: "active-1",
                taskName: "Active board task",
                deletedAt: null
            }),
            task({ _id: "trashed-1", taskName: "Genuinely trashed" })
        ]);

        expect(
            await screen.findByText("Genuinely trashed")
        ).toBeInTheDocument();
        expect(screen.queryByText("Active board task")).not.toBeInTheDocument();
        expect(screen.getAllByTestId("trash-drawer-row")).toHaveLength(1);
    });

    it("issues GET /tasks?projectId=…&includeTrashed=true when opened", async () => {
        renderDrawer();

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const url = String(fetchMock.mock.calls[0][0]);
        expect(url).toContain("tasks");
        expect(url).toContain(`projectId=${PROJECT_ID}`);
        expect(url).toContain("includeTrashed=true");
    });

    it("does not fetch while the drawer is closed", () => {
        renderDrawer({ open: false });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("renders the empty state when there are no trashed tasks", async () => {
        renderDrawer({}, []);
        expect(
            await screen.findByTestId("trash-drawer-empty")
        ).toBeInTheDocument();
        expect(
            screen.queryByTestId("trash-drawer-row")
        ).not.toBeInTheDocument();
    });

    it("Restore fires PUT /tasks/restore with { _id } and the row leaves the list", async () => {
        // First trash-list fetch returns the seeded task; after the restore
        // invalidates ["tasks"], the active trash query refetches and the
        // backend now reports an empty trash — so the row must disappear.
        let restored = false;
        fetchMock.mockImplementation((input, init) => {
            const url = String(input);
            const method = (init?.method ?? "GET").toString().toUpperCase();
            if (url.includes("tasks/restore") && method === "PUT") {
                restored = true;
                return Promise.resolve(response({ _id: "task-1" }));
            }
            // The trash list GET.
            return Promise.resolve(response(restored ? [] : [task()]));
        });

        renderDrawer({}, [task()]);

        const restoreButton = await screen.findByTestId("trash-drawer-restore");
        fireEvent.click(restoreButton);

        // The restore call carries the task _id in the PUT body.
        await waitFor(() => {
            const restoreCall = fetchMock.mock.calls.find(([url]) =>
                String(url).includes("tasks/restore")
            );
            expect(restoreCall).toBeDefined();
        });
        const restoreCall = fetchMock.mock.calls.find(([url]) =>
            String(url).includes("tasks/restore")
        );
        expect(String(restoreCall?.[0])).toContain("tasks/restore");
        expect(restoreCall?.[1]?.method).toBe("PUT");
        expect(restoreCall?.[1]?.body).toBe(JSON.stringify({ _id: "task-1" }));

        // The invalidation refetched the (now-empty) trash list, so the row
        // is gone and the empty state shows.
        await waitFor(() =>
            expect(
                screen.queryByTestId("trash-drawer-row")
            ).not.toBeInTheDocument()
        );
        expect(
            await screen.findByTestId("trash-drawer-empty")
        ).toBeInTheDocument();
    });

    it("Restore invalidates the ['tasks'] prefix so BOTH the board and trash lists refetch", async () => {
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

        fireEvent.click(await screen.findByTestId("trash-drawer-restore"));

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
                ["tasks", { projectId: PROJECT_ID, includeTrashed: true }]
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

        fireEvent.click(await screen.findByTestId("trash-drawer-purge"));
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
        // refetches the (now-empty) trash.
        await waitFor(() =>
            expect(
                screen.queryByTestId("trash-drawer-row")
            ).not.toBeInTheDocument()
        );
    });

    it("exposes per-row aria-labels carrying the task name", async () => {
        renderDrawer({}, [task({ taskName: "Recover me" })]);

        expect(
            await screen.findByRole("button", {
                name: /Restore task “Recover me”/i
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

        expect(screen.getByTestId("trash-drawer")).toBeInTheDocument();
        const surface = screen.getByTestId("trash-drawer-surface");
        expect(surface).toBeInTheDocument();
        expect(surface).toHaveAttribute("data-detent", "medium");
        expect(screen.getByTestId("trash-drawer-grabber")).toBeInTheDocument();
        // The seeded row still renders inside the Sheet body.
        expect(await screen.findByText("Trashed task")).toBeInTheDocument();
    });
});
