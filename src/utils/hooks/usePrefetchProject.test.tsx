import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

import usePrefetchProject from "./usePrefetchProject";

/*
 * `usePrefetchProject` is the single source of the prefetch (key, fetcher)
 * pairs the project cards / switcher use on hover. These tests pin the
 * contract that makes the prefetch a board-route cache HIT: the exact
 * query keys `useReactQuery` builds for the board's `projects` / `boards`
 * / `tasks` queries, plus the once-per-id guard.
 */
describe("usePrefetchProject", () => {
    const renderPrefetch = () => {
        const client = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });
        const prefetchSpy = jest
            .spyOn(client, "prefetchQuery")
            .mockResolvedValue(undefined);
        const wrapper = ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={client}>
                {children}
            </QueryClientProvider>
        );
        const { result } = renderHook(() => usePrefetchProject(), { wrapper });
        return { prefetch: result.current, prefetchSpy };
    };

    it("warms the exact project / board / tasks query keys the board reads", () => {
        const { prefetch, prefetchSpy } = renderPrefetch();

        act(() => prefetch("p1"));

        const keys = prefetchSpy.mock.calls.map(
            (call) => (call[0] as { queryKey: unknown[] }).queryKey
        );
        expect(keys).toEqual([
            ["projects", { projectId: "p1" }],
            ["boards", { projectId: "p1" }],
            ["tasks", { projectId: "p1" }]
        ]);
    });

    it("prefetches at most once per project id per session", () => {
        const { prefetch, prefetchSpy } = renderPrefetch();

        act(() => prefetch("p1"));
        act(() => prefetch("p1"));
        act(() => prefetch("p1"));
        expect(prefetchSpy).toHaveBeenCalledTimes(3); // 3 queries, one pass

        // A different id warms its own three queries.
        act(() => prefetch("p2"));
        expect(prefetchSpy).toHaveBeenCalledTimes(6);
    });

    it("is a no-op for an undefined project id", () => {
        const { prefetch, prefetchSpy } = renderPrefetch();
        act(() => prefetch(undefined));
        expect(prefetchSpy).not.toHaveBeenCalled();
    });
});
