import {
    QueryClient,
    QueryKey,
    hashKey,
    useQueryClient
} from "@tanstack/react-query";
import {
    useCallback,
    useEffect,
    useMemo,
    useState,
    useSyncExternalStore
} from "react";

const useCachedQueryData = <T>(queryKey: QueryKey): T | undefined => {
    const queryClient = useQueryClient();
    /*
     * Hash the watched key once per render so the subscribe / getSnapshot
     * callbacks below are keyed on a primitive (string) rather than the
     * unstable array reference call sites pass in. Without this the
     * `subscribe` callback's deps would churn every render — re-subscribing
     * on every render is harmless to React but means the cache observer is
     * thrown away + recreated each commit, which is wasteful.
     */
    const watchedHash = useMemo(() => hashKey(queryKey), [queryKey]);

    const subscribe = useCallback(
        (onStoreChange: () => void) =>
            /*
             * Filter cache events by query hash so this subscriber only
             * wakes when ITS query changes, not on every unrelated cache
             * mutation. Without this filter, mounting any new
             * `useReactQuery` consumer elsewhere in the tree (e.g.
             * ProjectModal's `["projects", {projectId}]` + `["users/members"]`
             * observers) fires a cache `observerAdded` event that calls
             * `onStoreChange` here, which schedules a re-render on the
             * subscribing component (e.g. AuthProvider, which reads
             * `["users"]`). React's setState-in-render guard then warns:
             * "Cannot update a component (AuthProvider) while rendering a
             * different component (ProjectModal)". Filtering by hash
             * scopes the wake to the actual key this caller watches.
             */
            queryClient.getQueryCache().subscribe((event) => {
                if (!event) return;
                if (event.query.queryHash !== watchedHash) return;
                onStoreChange();
            }),
        [queryClient, watchedHash]
    );
    const getSnapshot = useCallback(
        () => queryClient.getQueryData<T>(queryKey),
        [queryClient, queryKey]
    );

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

export default useCachedQueryData;

/**
 * Pure scan of every cache entry whose key starts with `prefix`. The data
 * may be a single entity (e.g. `useReactQuery<IProject>("projects", {
 * projectId })` returns one project) or an array of entities (the list
 * variant). Both shapes are flattened into a single array. Entries are
 * deduped by `_id` so the same project surfacing in two parametric
 * variants is only returned once.
 *
 * Why this exists: `useReactQuery` keys parametric calls as `[endpoint,
 * filterRequest(params)]`, so the bare `[endpoint]` key the FE tools used
 * to read from is almost never populated in production (see review
 * follow-up #2). Tools and palette consumers must scan all matching
 * entries to see the data the screens actually loaded.
 */
export const gatherCachedList = <T extends { _id?: string }>(
    queryClient: QueryClient,
    prefix: QueryKey
): T[] => {
    const entries = queryClient.getQueryCache().findAll({ queryKey: prefix });
    const collected: T[] = [];
    for (const entry of entries) {
        const data = entry.state.data;
        if (Array.isArray(data)) {
            collected.push(...(data as T[]));
        } else if (data && typeof data === "object" && (data as T)._id) {
            collected.push(data as T);
        }
    }
    const byId = new Map<string, T>();
    const unkeyed: T[] = [];
    for (const item of collected) {
        if (item && item._id) byId.set(item._id, item);
        else unkeyed.push(item);
    }
    return [...Array.from(byId.values()), ...unkeyed];
};

/**
 * Hook variant of `gatherCachedList` — re-runs whenever the query cache
 * changes so consumers see new entries the moment the underlying screen
 * loads them. Uses `useState` + a deferred subscription instead of
 * `useSyncExternalStore` because the gather pass returns a fresh array
 * on every call and `useSyncExternalStore` requires identity stability
 * to avoid tearing. The deferred update also avoids React's "setState
 * during render of another component" warning that fires when the
 * QueryCache notifies synchronously while a `useReactQuery` consumer is
 * mid-render.
 */
export const useGatheredCachedList = <T extends { _id?: string }>(
    prefix: QueryKey
): T[] => {
    const queryClient = useQueryClient();
    const [snapshot, setSnapshot] = useState<T[]>(() =>
        gatherCachedList<T>(queryClient, prefix)
    );

    // `prefix` is referentially unstable from the call site (typically a
    // fresh array literal each render). Serialise it once so the effect
    // dep is a primitive — keeps the React Hooks lint rule happy too.
    const prefixKey = JSON.stringify(prefix);

    useEffect(() => {
        // Recompute immediately on mount so we pick up entries that
        // landed between render and subscription.
        setSnapshot(gatherCachedList<T>(queryClient, prefix));
        const unsubscribe = queryClient.getQueryCache().subscribe(() => {
            // Defer the recompute to a microtask so we never call
            // setState while another component is rendering (the
            // queryCache notify path can fire from inside the
            // observer setup of an unrelated `useReactQuery` mount).
            queueMicrotask(() => {
                setSnapshot(gatherCachedList<T>(queryClient, prefix));
            });
        });
        return unsubscribe;
        // Depend on the serialised `prefixKey`, not `prefix` itself —
        // call sites pass a fresh array literal every render, which would
        // re-fire the effect, call setSnapshot with a new array, and loop
        // (since `gatherCachedList` returns a new array each time).
    }, [queryClient, prefixKey]);

    return snapshot;
};
