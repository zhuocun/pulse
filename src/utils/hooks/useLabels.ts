import { useCallback } from "react";

import useReactMutation from "./useReactMutation";
import useReactQuery from "./useReactQuery";

/**
 * Project-labels data hook (M2 — backend task-richness feature).
 *
 * Mirrors the thin REST-resource convention used by `useMembersList`
 * and `useNotifications`: a single exported endpoint string + matching
 * query key, a `useReactQuery` read for the list, and an optional
 * `useReactMutation` POST for create. The endpoint string is the bare
 * resource path (`"labels"`, no `/api/v1/` prefix) exactly like
 * `"users/members"`, `"tasks"`, and `"notifications"` — `useApi`
 * prepends `environment.apiBaseUrl` (`/api/v1`) so the same-origin
 * session cookie rides every request.
 *
 * Backend contract:
 *   - `GET /api/v1/labels/?projectId=` → the project's `ILabel[]`
 *     (`{ _id, projectId, name, color }`).
 *   - `POST /api/v1/labels/` body `{ projectId, name, color? }` → create.
 *   - `PUT /api/v1/labels/` body `{ _id, name?, color? }` → update.
 *   - `DELETE /api/v1/labels/?labelId=` → delete.
 *
 * The query is keyed per-project (`["labels", { projectId }]`) so the
 * label picker on one board never reads another project's labels, and a
 * create invalidates exactly that project's list (the `useReactMutation`
 * default). The list query is disabled until a `projectId` is known so
 * the board doesn't fire a `GET /labels/?projectId=undefined` while the
 * route is still resolving.
 */
export const LABELS_ENDPOINT = "labels";

export const getLabelsQueryKey = (projectId: string | undefined) =>
    ["labels", { projectId }] as const;

/**
 * Labels rarely change relative to how often the board re-renders, so we
 * mirror `useMembersList`'s 5-minute stale window: a freshly-seeded /
 * recently-fetched list serves from cache without a background refetch on
 * every modal open or card mount.
 */
export const LABELS_STALE_TIME_MS = 5 * 60 * 1000;

interface UseLabels {
    /** The project's labels. `undefined` until the first load resolves. */
    labels: ILabel[] | undefined;
    /** True while the list query is in flight. */
    isLoading: boolean;
    /**
     * Creates a label on the active project (POST `{ projectId, name, color? }`).
     * Resolves with the backend acknowledgement; the list re-fetches on
     * success via the mutation's default invalidation.
     */
    createLabel: (input: { name: string; color?: string }) => Promise<unknown>;
    /** True while the create mutation is in flight. */
    isCreating: boolean;
}

const useLabels = (projectId: string | undefined): UseLabels => {
    const { data, isLoading } = useReactQuery<ILabel[]>(
        LABELS_ENDPOINT,
        { projectId },
        undefined,
        undefined,
        undefined,
        Boolean(projectId),
        { staleTime: LABELS_STALE_TIME_MS }
    );

    /*
     * Normalize to a guaranteed `ILabel[] | undefined`. The list endpoint
     * returns an array, but the query cache is shared with the `POST`
     * mutation key — a stray non-array payload (the write-endpoint string
     * ack, a malformed / errored response, or a test's global fetch stub)
     * must not crash the `.map` consumers in the picker / card. A
     * non-array resolves to `undefined` ("no data yet") rather than
     * throwing.
     */
    const list = Array.isArray(data) ? data : undefined;

    const { mutateAsync: create, isLoading: isCreating } =
        useReactMutation<unknown>(
            LABELS_ENDPOINT,
            "POST",
            getLabelsQueryKey(projectId)
        );

    const createLabel = useCallback(
        (input: { name: string; color?: string }) =>
            create({ projectId, name: input.name, color: input.color }),
        [create, projectId]
    );

    return {
        labels: list,
        isLoading,
        createLabel,
        isCreating
    };
};

export default useLabels;
