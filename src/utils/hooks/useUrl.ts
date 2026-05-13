import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { URLSearchParamsInit, useSearchParams } from "react-router-dom";

import filterRequest from "../filterRequest";

/**
 * URL-as-state hook. Returns the current value of the requested keys and a
 * setter that writes them back to the location search string.
 *
 * History — re-render binding on iOS Safari:
 * Modals/drawers that derive `open` purely from `useSearchParams()` were
 * intermittently failing to react to URL changes on iOS Safari WebKit. The
 * click reached `setSearchParams` (the URL did update — refreshing the page
 * showed the modal), but the consuming component never re-rendered with the
 * new search value, so the modal never opened and, once open via refresh,
 * could not be closed. To make UI flip in the same React render as the
 * click, we now keep a local React-state mirror of the keys we read:
 *
 *   - `setUrlParams` updates local state immediately (state is what the
 *     consumer reads — React's setState always re-renders, regardless of
 *     how `useSearchParams` propagates), and writes the URL as a side
 *     effect for deep-linking / back-button parity.
 *   - When the URL changes from outside the hook (browser back/forward,
 *     external `navigate`, refresh), an effect reconciles local state to
 *     match. A ref guard prevents the reconcile from firing for changes the
 *     hook itself just wrote.
 *
 * Net effect: open/close are synchronous on tap; deep links and back-button
 * navigation still work.
 */
const useUrl = <K extends string>(keys: K[]) => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [stateKeys] = useState(keys);

    const urlDerived = useMemo(
        () =>
            stateKeys.reduce(
                (prev, key) => {
                    return { ...prev, [key]: searchParams.get(key) };
                },
                {} as { [key in K]: string | null }
            ),
        [searchParams, stateKeys]
    );

    const [localState, setLocalState] = useState(urlDerived);
    /*
     * Tracks the URL→state snapshot we have already absorbed, so the
     * reconcile effect can tell "URL changed because the hook just wrote it"
     * (no-op) from "URL changed because of an external navigation" (sync
     * state). Stringify is fine — keys are a small known set.
     */
    const lastUrlJsonRef = useRef(JSON.stringify(urlDerived));

    useEffect(() => {
        const nextJson = JSON.stringify(urlDerived);
        if (nextJson !== lastUrlJsonRef.current) {
            lastUrlJsonRef.current = nextJson;
            setLocalState(urlDerived);
        }
    }, [urlDerived]);

    const setUrlParams = useCallback(
        (params: Partial<{ [key in K]: unknown }>) => {
            setLocalState((prev) => {
                const next = { ...prev };
                for (const [k, v] of Object.entries(params)) {
                    const value =
                        v === undefined || v === null || v === ""
                            ? null
                            : String(v);
                    (next as Record<string, string | null>)[k] = value;
                }
                /*
                 * Pre-record the snapshot we are about to write to the URL so
                 * the reconcile effect can treat the subsequent
                 * `useSearchParams` update as a no-op (we already have the
                 * value locally). Without this guard, the effect would race
                 * the `setSearchParams` write and could overwrite an
                 * in-flight `setLocalState` with stale URL data.
                 */
                lastUrlJsonRef.current = JSON.stringify(next);
                return next;
            });
            setSearchParams((prev) => {
                const obj = filterRequest({
                    ...Object.fromEntries(prev.entries()),
                    ...params
                }) as URLSearchParamsInit;
                return obj;
            });
        },
        [setSearchParams]
    );

    return [localState, setUrlParams] as const;
};

export default useUrl;
