import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { URLSearchParamsInit, useSearchParams } from "react-router-dom";

import filterRequest from "../filterRequest";

/**
 * URL-as-state hook used by every modal/drawer/page-filter.
 *
 * Why this design — cross-instance propagation:
 *
 * Several overlays in the app are mounted in a different React subtree
 * from the button that opens them (e.g. the Create-project button lives
 * in `ProjectPage`, but `ProjectModal` is mounted up in `MainLayout`).
 * Each calls `useUrl` and that produces two independent hook instances
 * over the same URL state. On iOS Safari WebKit the second instance was
 * failing to observe writes made by the first — the address bar updated
 * (refreshing brought the modal up), but the in-process modal never
 * reacted. Same shape for the project-card `<Link>` → board navigation
 * and the X-to-close case.
 *
 * `useSearchParams()`' subscription path is the moving piece that fails
 * on the affected device. To stay independent of it, every `useUrl`
 * subscribes to a module-level pub/sub: a write by any instance calls
 * `notify()`, which forces every other instance to re-render and re-read
 * the URL from `window.location.search` — the ground truth that
 * `history.pushState` updates synchronously inside `setSearchParams`.
 *
 * `useSearchParams` is still used for two things:
 *   1. Writes go through its setter, so React Router stays authoritative
 *      for the browser history (back/forward, view-transitions, etc.).
 *   2. Reads fall back to it when `window.location.search` is empty —
 *      that is, when the test harness uses `MemoryRouter`, which keeps
 *      its state in memory rather than touching `window.location`.
 *
 * A `popstate` listener picks up navigations that originate outside the
 * hook (browser back/forward, native iOS swipe-back).
 */
const listeners = new Set<() => void>();

const subscribe = (callback: () => void): (() => void) => {
    listeners.add(callback);
    return () => {
        listeners.delete(callback);
    };
};

const notify = (): void => {
    for (const l of listeners) l();
};

if (typeof window !== "undefined") {
    window.addEventListener("popstate", notify);
}

const useUrl = <K extends string>(keys: K[]) => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [stateKeys] = useState(keys);

    const [tick, forceUpdate] = useReducer((x: number) => x + 1, 0);
    useEffect(() => subscribe(forceUpdate), []);

    /*
     * `tick` is intentionally a dep below: pub/sub-triggered re-renders
     * need to re-read `window.location.search`, and without `tick` in
     * the dep list `useMemo` would skip recomputation when the
     * `searchParams` reference happens to be stable across renders
     * (which is the failure mode on the affected device).
     */
    void tick;
    const params = useMemo(() => {
        const winSearch =
            typeof window !== "undefined" ? window.location.search : "";
        const sp = winSearch ? new URLSearchParams(winSearch) : searchParams;
        return stateKeys.reduce(
            (prev, key) => {
                return { ...prev, [key]: sp.get(key) };
            },
            {} as { [key in K]: string | null }
        );
    }, [searchParams, stateKeys, tick]);

    const setUrlParams = useCallback(
        (next: Partial<{ [key in K]: unknown }>) => {
            setSearchParams((prev) => {
                const obj = filterRequest({
                    ...Object.fromEntries(prev.entries()),
                    ...next
                }) as URLSearchParamsInit;
                return obj;
            });
            /*
             * `setSearchParams` calls `history.pushState` synchronously,
             * which updates `window.location.search`. Queue notify on a
             * microtask so subscribers re-read after the URL write, not
             * before.
             */
            queueMicrotask(notify);
        },
        [setSearchParams]
    );

    return [params, setUrlParams] as const;
};

export default useUrl;
