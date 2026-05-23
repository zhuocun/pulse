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
