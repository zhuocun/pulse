import { act, renderHook } from "@testing-library/react";
import { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import useCachedQueryData, {
    gatherCachedList,
    useGatheredCachedList
} from "./useCachedQueryData";

const createWrapper = (queryClient: QueryClient) =>
    function Wrapper({ children }: { children: ReactNode }) {
        return (
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        );
    };

describe("useCachedQueryData", () => {
    it("returns undefined when the cache is empty", () => {
        const qc = new QueryClient();
        const { result } = renderHook(
            () => useCachedQueryData<IProject[]>(["projects"]),
            { wrapper: createWrapper(qc) }
        );
        expect(result.current).toBeUndefined();
    });

    it("returns the cached value for the matching query key", () => {
        const qc = new QueryClient();
        const seeded: IProject[] = [
            {
                _id: "p1",
                createdAt: "0",
                managerId: "m1",
                organization: "Acme",
                projectName: "Roadmap"
            }
        ];
        qc.setQueryData(["projects"], seeded);
        const { result } = renderHook(
            () => useCachedQueryData<IProject[]>(["projects"]),
            { wrapper: createWrapper(qc) }
        );
        expect(result.current).toEqual(seeded);
    });

    it("re-renders when the cache for the same key is updated", () => {
        const qc = new QueryClient();
        const { result } = renderHook(
            () => useCachedQueryData<IProject[]>(["projects"]),
            { wrapper: createWrapper(qc) }
        );
        expect(result.current).toBeUndefined();

        act(() => {
            qc.setQueryData<IProject[]>(
                ["projects"],
                [
                    {
                        _id: "p1",
                        createdAt: "0",
                        managerId: "m1",
                        organization: "Acme",
                        projectName: "Later"
                    }
                ]
            );
        });
        expect(result.current?.[0]._id).toBe("p1");
    });
});

describe("gatherCachedList", () => {
    const project = (overrides: Partial<IProject>): IProject => ({
        _id: "p?",
        createdAt: "0",
        managerId: "m1",
        organization: "Acme",
        projectName: "?",
        ...overrides
    });

    it("returns [] when no cache entry matches the prefix", () => {
        const qc = new QueryClient();
        expect(gatherCachedList<IProject>(qc, ["projects"])).toEqual([]);
    });

    it("merges every parametric entry under the prefix", () => {
        const qc = new QueryClient();
        qc.setQueryData<IProject[]>(
            ["projects", { managerId: "m1" }],
            [project({ _id: "p1" })]
        );
        qc.setQueryData<IProject[]>(
            ["projects", { managerId: "m2" }],
            [project({ _id: "p2" })]
        );
        const result = gatherCachedList<IProject>(qc, ["projects"]);
        expect(result.map((p) => p._id).sort()).toEqual(["p1", "p2"]);
    });

    it("dedupes entries by _id across parametric variants", () => {
        const qc = new QueryClient();
        qc.setQueryData<IProject[]>(
            ["projects", { variant: "a" }],
            [project({ _id: "p1" })]
        );
        qc.setQueryData<IProject[]>(
            ["projects", { variant: "b" }],
            [project({ _id: "p1" }), project({ _id: "p2" })]
        );
        const result = gatherCachedList<IProject>(qc, ["projects"]);
        expect(result.map((p) => p._id).sort()).toEqual(["p1", "p2"]);
    });

    it("flattens a single-entity cache shape into the result", () => {
        const qc = new QueryClient();
        qc.setQueryData<IProject>(
            ["projects", { projectId: "p3" }],
            project({ _id: "p3" })
        );
        const result = gatherCachedList<IProject>(qc, ["projects"]);
        expect(result).toHaveLength(1);
        expect(result[0]._id).toBe("p3");
    });

    it("does not crash on non-matching siblings (e.g. ['tasks', ...])", () => {
        const qc = new QueryClient();
        qc.setQueryData<ITask[]>(
            ["tasks", { projectId: "p1" }],
            [
                {
                    _id: "t1",
                    columnId: "c1",
                    coordinatorId: "m1",
                    epic: "x",
                    index: 0,
                    note: "",
                    projectId: "p1",
                    storyPoints: 1,
                    taskName: "T",
                    type: "Task"
                }
            ]
        );
        expect(gatherCachedList<IProject>(qc, ["projects"])).toEqual([]);
    });
});

describe("useGatheredCachedList", () => {
    const project = (overrides: Partial<IProject>): IProject => ({
        _id: "p?",
        createdAt: "0",
        managerId: "m1",
        organization: "Acme",
        projectName: "?",
        ...overrides
    });

    it("returns the initial snapshot synchronously on mount", () => {
        const qc = new QueryClient();
        qc.setQueryData<IProject[]>(
            ["projects", { managerId: "m1" }],
            [project({ _id: "p1" })]
        );
        const { result } = renderHook(
            () => useGatheredCachedList<IProject>(["projects"]),
            { wrapper: createWrapper(qc) }
        );
        expect(result.current.map((p) => p._id)).toEqual(["p1"]);
    });

    it("updates when a new parametric entry lands after mount", async () => {
        const qc = new QueryClient();
        const { result } = renderHook(
            () => useGatheredCachedList<IProject>(["projects"]),
            { wrapper: createWrapper(qc) }
        );
        expect(result.current).toEqual([]);

        await act(async () => {
            qc.setQueryData<IProject[]>(
                ["projects", { managerId: "m1" }],
                [project({ _id: "p1" })]
            );
            // Subscribe handler queues a microtask before re-snapshotting.
            await Promise.resolve();
        });
        expect(result.current.map((p) => p._id)).toEqual(["p1"]);
    });
});
