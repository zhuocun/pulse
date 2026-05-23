import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import useTaskPanelSiblings from "./useTaskPanelSiblings";

interface ProbeProps {
    onReady: (api: ReturnType<typeof useTaskPanelSiblings>) => void;
}

const Probe: React.FC<ProbeProps> = ({ onReady }) => {
    const api = useTaskPanelSiblings();
    useEffect(() => {
        onReady(api);
    }, [api, onReady]);
    return null;
};

const LocationProbe: React.FC = () => {
    const loc = useLocation();
    return <div data-testid="path">{loc.pathname}</div>;
};

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
    initialPath: string,
    seed: { columns: IColumn[]; tasks: ITask[]; projectId?: string }
) => {
    const ref: { current: ReturnType<typeof useTaskPanelSiblings> | null } = {
        current: null
    };
    const queryClient = buildQueryClient(
        seed.projectId ?? "p1",
        seed.columns,
        seed.tasks
    );
    const utils = render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[initialPath]}>
                <Routes>
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

describe("useTaskPanelSiblings", () => {
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

        expect(getByTestId("path").textContent).toBe(
            "/projects/p1/board/task/t1"
        );
    });

    it("orders tasks by column.index, then by task.index within the column", () => {
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

        expect(ref.current!.prevTaskId).toBeNull();
        expect(ref.current!.nextTaskId).toBe("t2");
    });
});
