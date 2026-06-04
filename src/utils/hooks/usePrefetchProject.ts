import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";

import filterRequest from "../filterRequest";

import { api } from "./useApi";
import { getReactQueryKey } from "./useReactQuery";

/**
 * Felt-by-user performance (ui-todo §2.A.7 / §9): warm the queries the
 * board route will consume the instant the user *signals intent* to open
 * a project — i.e. on hover / keyboard-focus of a project row, card, or
 * switcher entry. By the time the click lands, the board's columns and
 * tasks are already in (or in-flight to) the React Query cache, so the
 * board paints from cache instead of starting three cold round-trips.
 *
 * The prefetched (key, fetcher) pairs are derived from the SAME
 * primitives the board route uses through `useReactQuery`:
 *   - project:  ["projects", { projectId }]  → GET projects?projectId=…
 *   - board:    ["boards",   { projectId }]  → GET boards?projectId=…
 *   - tasks:    ["tasks",    { projectId }]  → GET tasks?projectId=…
 *
 * `getReactQueryKey` is the very helper `useReactQuery` calls to build
 * its `queryKey`, and the `queryFn` mirrors `useReactQuery`'s GET
 * exactly (`api(endPoint, { data: filterRequest(param), method: "GET" })`).
 * Keeping both in lock-step is what makes the prefetch a cache *hit* on
 * the board — a divergent key or fetcher would silently warm a cache
 * entry the board never reads, wasting the round-trip.
 *
 * Guard: prefetch fires at most once per project id per hover session so
 * a stream of `mousemove`/`mouseenter` events on the same target does
 * not spam the network. The `prefetchedRef` set is intentionally
 * unbounded for the component's lifetime — the set of projects a user
 * can hover before navigating away is tiny, and React Query's own
 * `staleTime` (the queries are prefetched with the provider default)
 * guards the actual fetch frequency on top of this.
 */
const usePrefetchProject = () => {
    const queryClient = useQueryClient();
    const prefetchedRef = useRef<Set<string>>(new Set());

    return useCallback(
        (projectId: string | undefined) => {
            if (!projectId) return;
            if (prefetchedRef.current.has(projectId)) return;
            prefetchedRef.current.add(projectId);

            const param = { projectId };
            const endpoints = ["projects", "boards", "tasks"] as const;
            for (const endPoint of endpoints) {
                void queryClient.prefetchQuery({
                    queryKey: getReactQueryKey(endPoint, param),
                    queryFn: async () =>
                        api(endPoint, {
                            data: filterRequest(param),
                            method: "GET"
                        })
                });
            }
        },
        [queryClient]
    );
};

export default usePrefetchProject;
