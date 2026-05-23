import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Parsed payload of a Web Share Target invocation, surfaced by
 * `/share` when another app shares a URL / text / title into Pulse.
 *
 * All three fields are optional — different platforms surface
 * different combinations:
 *   - Android Chrome sharing from the browser typically supplies
 *     `title` (page title) + `url` (page URL).
 *   - Sharing plain text from a notes app may supply only `text`.
 *   - A user could also land on `/share` manually (no params at all),
 *     in which case the page falls back to a "Nothing to share" state.
 */
export interface ShareTargetParams {
    title?: string;
    text?: string;
    url?: string;
}

/**
 * Reads the Web Share Target payload out of the current URL.
 *
 * The page is wired to the manifest entry
 *
 *     "share_target": {
 *         "action": "/share",
 *         "method": "GET",
 *         "params": { "title": "title", "text": "text", "url": "url" }
 *     }
 *
 * so the browser forwards the share intent as URL search params on a
 * standard navigation. This hook is a thin wrapper around
 * `useSearchParams` that normalises the three fields and memoises the
 * resulting object so consumers can pass it through `useEffect` /
 * `useMemo` dependency arrays without churning on every render.
 *
 * Returns an object with each field set to the URL-decoded value, or
 * `undefined` if the param is absent.
 */
const useShareTargetParams = (): ShareTargetParams => {
    const [search] = useSearchParams();
    return useMemo(
        () => ({
            title: search.get("title") ?? undefined,
            text: search.get("text") ?? undefined,
            url: search.get("url") ?? undefined
        }),
        [search]
    );
};

export default useShareTargetParams;
