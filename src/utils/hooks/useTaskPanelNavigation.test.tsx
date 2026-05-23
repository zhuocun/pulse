import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import {
    MemoryRouter,
    Route,
    Routes,
    useLocation,
    useParams
} from "react-router-dom";

import useTaskPanelNavigation from "./useTaskPanelNavigation";

interface ProbeProps {
    onReady: (api: ReturnType<typeof useTaskPanelNavigation>) => void;
}

const Probe: React.FC<ProbeProps> = ({ onReady }) => {
    const api = useTaskPanelNavigation();
    useEffect(() => {
        onReady(api);
    }, [api, onReady]);
    return null;
};

const LocationProbe: React.FC = () => {
    const loc = useLocation();
    return <div data-testid="path">{loc.pathname}</div>;
};

const ParamProbe: React.FC = () => {
    const params = useParams();
    return <div data-testid="param">{params.projectId ?? ""}</div>;
};

/*
 * Build a QueryClient with the board's `boards` and `tasks` cache
 * keys pre-seeded so the hook computes sibling IDs synchronously. The
 * hook uses `useReactQuery(endPoint, { projectId })` which keys into
 * `[endPoint, { projectId }]` — same shape as BoardPage and
 * TaskDetailPanel, so the same pre-seed pattern works here.
 */
const buildQueryClient = (
    projectId: string,
    columns: IColumn[],
    tasks: ITask[]
) => {
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false, staleTime: Infinity }
        }
    });
    queryClient.setQueryData(["boards", { projectId }], columns);
    queryClient.setQueryData(["tasks", { projectId }], tasks);
    return queryClient;
};

const renderHook = (
    initialPath = "/projects/p1/board",
    seed?: { columns: IColumn[]; tasks: ITask[]; projectId?: string }
) => {
    const ref: { current: ReturnType<typeof useTaskPanelNavigation> | null } = {
        current: null
    };
    const queryClient = buildQueryClient(
        seed?.projectId ?? "p1",
        seed?.columns ?? [],
        seed?.tasks ?? []
    );
    const utils = render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[initialPath]}>
                <Routes>
                    <Route
                        path="/projects/:projectId/board"
                        element={
                            <>
                                <Probe
                                    onReady={(api) => {
                                        ref.current = api;
                                    }}
                                />
                                <LocationProbe />
                                <ParamProbe />
                            </>
                        }
                    />
                    <Route
                        path="/projects/:projectId/board/task/:taskId"
                        element={
                            <>
                                <Probe
                                    onReady={(api) => {
                                        ref.current = api;
                                    }}
                                />
                                <LocationProbe />
                                <ParamProbe />
                            </>
                        }
                    />
                    <Route
                        path="/projects"
                        element={
                            <>
                                <Probe
                                    onReady={(api) => {
                                        ref.current = api;
                                    }}
                                />
                                <LocationProbe />
                            </>
                        }
                    />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>
    );
    return { ref, queryClient, ...utils };
};

const column = (overrides: Partial<IColumn> = {}): IColumn => ({
    _id: "column-1",
    columnName: "Todo",
    index: 0,
    projectId: "p1",
    ...overrides
});

const task = (overrides: Partial<ITask> = {}): ITask => ({
    _id: "task-1",
    columnId: "column-1",
    coordinatorId: "member-1",
    epic: "Feature",
    index: 0,
    note: "",
    projectId: "p1",
    storyPoints: 1,
    taskName: "Task 1",
    type: "Task",
    ...overrides
});

describe("useTaskPanelNavigation", () => {
    it("navigates to /projects/:projectId/board/task/:taskId via openTask", () => {
        const { ref, getByTestId } = renderHook();
        expect(getByTestId("path").textContent).toBe("/projects/p1/board");

        act(() => {
            ref.current!.openTask("task-42");
        });

        expect(getByTestId("path").textContent).toBe(
            "/projects/p1/board/task/task-42"
        );
    });

    it("accepts an explicit projectId override", () => {
        const { ref, getByTestId } = renderHook();

        act(() => {
            ref.current!.openTask("task-99", "p2");
        });

        expect(getByTestId("path").textContent).toBe(
            "/projects/p2/board/task/task-99"
        );
    });

    it("closeTask navigates back to /projects/:projectId/board", () => {
        const { ref, getByTestId } = renderHook(
            "/projects/p1/board/task/task-1"
        );
        expect(getByTestId("path").textContent).toBe(
            "/projects/p1/board/task/task-1"
        );

        act(() => {
            ref.current!.closeTask();
        });

        expect(getByTestId("path").textContent).toBe("/projects/p1/board");
    });

    it("openTask refuses to navigate when projectId is unresolvable", () => {
        const { ref, getByTestId } = renderHook("/projects");
        expect(getByTestId("path").textContent).toBe("/projects");

        act(() => {
            ref.current!.openTask("task-1");
        });

        // No navigation occurred — the hook bailed silently.
        expect(getByTestId("path").textContent).toBe("/projects");
    });

    it("openTask refuses to navigate when taskId is empty", () => {
        const { ref, getByTestId } = renderHook();

        act(() => {
            ref.current!.openTask("");
        });

        expect(getByTestId("path").textContent).toBe("/projects/p1/board");
    });

    it("returns stable function identities across re-renders of the SAME tree (B-T3)", () => {
        // Capture every render's api ref so we can compare identities
        // across re-renders within a single MemoryRouter mount. A bare
        // wrapper `{ tick }` prop forces the Probe to re-render without
        // remounting the tree, isolating the hook's `useCallback`
        // identity claim.
        const captured: ReturnType<typeof useTaskPanelNavigation>[] = [];
        const Capture: React.FC<{ tick: number }> = ({ tick }) => {
            const api = useTaskPanelNavigation();
            captured.push(api);
            void tick;
            return null;
        };
        const queryClient = buildQueryClient("p1", [], []);
        const { rerender } = render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/p1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={<Capture tick={0} />}
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );
        rerender(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/p1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={<Capture tick={1} />}
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );
        expect(captured.length).toBeGreaterThanOrEqual(2);
        const first = captured[0];
        const last = captured[captured.length - 1];
        // Referential identity holds across the rerender because both
        // `useCallback` deps (currentProjectId + navigate) are stable
        // within a single MemoryRouter instance.
        expect(last.openTask).toBe(first.openTask);
        expect(last.closeTask).toBe(first.closeTask);
    });
});

/*
 * Phase 3 A2 — swipe-between-tasks navigation. The hook computes
 * `nextTaskId` / `prevTaskId` from the live cache snapshot of
 * `boards` + `tasks`, and `goToNext` / `goToPrev` push the matching
 * route URL. These tests pre-seed the cache so the computation runs
 * synchronously — production deep-link visits resolve them once the
 * react-query fetch lands.
 */
describe("useTaskPanelNavigation sibling navigation (Phase 3 A2)", () => {
    const columns = [
        column({ _id: "c1", index: 0 }),
        column({ _id: "c2", index: 1 })
    ];
    const tasks = [
        task({ _id: "t1", columnId: "c1", index: 0 }),
        task({ _id: "t2", columnId: "c1", index: 1 }),
        task({ _id: "t3", columnId: "c2", index: 0 })
    ];

    it("exposes nextTaskId / prevTaskId in the ordered board sequence", () => {
        const { ref } = renderHook("/projects/p1/board/task/t2", {
            columns,
            tasks
        });

        expect(ref.current!.prevTaskId).toBe("t1");
        expect(ref.current!.nextTaskId).toBe("t3");
    });

    it("returns null for nextTaskId on the last task", () => {
        const { ref } = renderHook("/projects/p1/board/task/t3", {
            columns,
            tasks
        });

        expect(ref.current!.nextTaskId).toBeNull();
        expect(ref.current!.prevTaskId).toBe("t2");
    });

    it("returns null for prevTaskId on the first task", () => {
        const { ref } = renderHook("/projects/p1/board/task/t1", {
            columns,
            tasks
        });

        expect(ref.current!.prevTaskId).toBeNull();
        expect(ref.current!.nextTaskId).toBe("t2");
    });

    it("returns null for both siblings when only one task exists", () => {
        const { ref } = renderHook("/projects/p1/board/task/t1", {
            columns: [column({ _id: "c1", index: 0 })],
            tasks: [task({ _id: "t1", columnId: "c1", index: 0 })]
        });

        expect(ref.current!.nextTaskId).toBeNull();
        expect(ref.current!.prevTaskId).toBeNull();
    });

    it("returns null siblings when the cache is empty (deep-link, pre-fetch)", () => {
        const { ref } = renderHook("/projects/p1/board/task/t1", {
            columns: [],
            tasks: []
        });

        expect(ref.current!.nextTaskId).toBeNull();
        expect(ref.current!.prevTaskId).toBeNull();
    });

    it("goToNext navigates to the next sibling task URL", () => {
        const { ref, getByTestId } = renderHook("/projects/p1/board/task/t1", {
            columns,
            tasks
        });
        expect(getByTestId("path").textContent).toBe(
            "/projects/p1/board/task/t1"
        );

        act(() => {
            ref.current!.goToNext();
        });

        expect(getByTestId("path").textContent).toBe(
            "/projects/p1/board/task/t2"
        );
    });

    it("goToPrev navigates to the previous sibling task URL", () => {
        const { ref, getByTestId } = renderHook("/projects/p1/board/task/t3", {
            columns,
            tasks
        });
        expect(getByTestId("path").textContent).toBe(
            "/projects/p1/board/task/t3"
        );

        act(() => {
            ref.current!.goToPrev();
        });

        expect(getByTestId("path").textContent).toBe(
            "/projects/p1/board/task/t2"
        );
    });

    it("goToNext is a no-op at the end of the task list", () => {
        const { ref, getByTestId } = renderHook("/projects/p1/board/task/t3", {
            columns,
            tasks
        });

        act(() => {
            ref.current!.goToNext();
        });

        // Still on t3 — no navigation happened.
        expect(getByTestId("path").textContent).toBe(
            "/projects/p1/board/task/t3"
        );
    });

    it("goToPrev is a no-op at the start of the task list", () => {
        const { ref, getByTestId } = renderHook("/projects/p1/board/task/t1", {
            columns,
            tasks
        });

        act(() => {
            ref.current!.goToPrev();
        });

        // Still on t1 — no navigation happened.
        expect(getByTestId("path").textContent).toBe(
            "/projects/p1/board/task/t1"
        );
    });

    it("orders tasks by column.index, then by task.index within the column", () => {
        // Tasks out of order in the cache to confirm the sort runs.
        const reorderedColumns = [
            column({ _id: "c2", index: 1 }),
            column({ _id: "c1", index: 0 })
        ];
        const reorderedTasks = [
            task({ _id: "t3", columnId: "c2", index: 0 }),
            task({ _id: "t2", columnId: "c1", index: 1 }),
            task({ _id: "t1", columnId: "c1", index: 0 })
        ];
        const { ref } = renderHook("/projects/p1/board/task/t1", {
            columns: reorderedColumns,
            tasks: reorderedTasks
        });

        // Despite the cache order, the visual board order is
        // c1(0) → c2(1) and t1(0) → t2(1) inside c1, so t2 is next
        // after t1 and t1 has no prev.
        expect(ref.current!.prevTaskId).toBeNull();
        expect(ref.current!.nextTaskId).toBe("t2");
    });
});
