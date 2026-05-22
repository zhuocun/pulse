import { useEffect, useRef } from "react";

/**
 * Brand suffix appended to every page name composed via
 * {@link composeBrandedTitle}. Centralised so the format stays in one
 * place: callers pass the bare (localized) page name and the hook
 * paints `${page} · Pulse` into `document.title`.
 */
export const BRAND_NAME = "Pulse";

/**
 * Composes the full `document.title` value: `${page} · Pulse`, or
 * just `Pulse` when the page name is empty. Exported separately so
 * tests can assert the composed string and so non-React call sites
 * (e.g. service-worker UPDATE notifications) can mirror the format.
 */
export const composeBrandedTitle = (page: string): string =>
    page ? `${page} · ${BRAND_NAME}` : BRAND_NAME;

/**
 * React Hook that dynamically updates `document.title`.
 *
 *  1. The first effect sets the title to whatever string is passed.
 *     Pages that own brand-suffixed surfaces pass
 *     `composeBrandedTitle(microcopy.pageTitle.X)`; legacy callers
 *     pass the bare string (board, project-detail) and keep their
 *     current titles unchanged.
 *  2. The second effect restores the previous title when the
 *     component unmounts, unless `keepOnMount` is true.
 *
 * @param title  Title string to write to `document.title`. Use
 *               {@link composeBrandedTitle} on auth + project-list
 *               surfaces to keep the `… · Pulse` format consistent.
 * @param keepOnMount  When `true` (default), the new title persists
 *               after the component unmounts. When `false`, the
 *               previous title is restored on unmount.
 */
const useTitle = (title: string, keepOnMount = true) => {
    const oldTitle = useRef(document.title).current;

    useEffect(() => {
        document.title = title;
    }, [title]);

    useEffect(() => {
        return () => {
            if (!keepOnMount) {
                document.title = oldTitle;
            }
        };
    }, [keepOnMount, oldTitle]);
};

export default useTitle;
