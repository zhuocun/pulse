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
 *   - `DELETE /api/v1/labels/?labelId=` → delete (server cascade-strips
 *     the id from every task in the project, so a deleted label's chip
 *     disappears from the board after the tasks query refetches).
 *
 * The query is keyed per-project (`["labels", { projectId }]`) so the
 * label picker on one board never reads another project's labels, and a
 * create / update / delete invalidates exactly that project's list (the
 * `useReactMutation` default). The list query is disabled until a
 * `projectId` is known so the board doesn't fire a
 * `GET /labels/?projectId=undefined` while the route is still resolving.
 *
 * All three writes are EDITOR-gated server-side (a non-editor write
 * 403s). The label-management surface mirrors the members / milestones
 * managers' FE role-gate — it derives the caller's project role from the
 * `useProjectMembers` roster + the project's `managerId` and hides the
 * write controls from a viewer/guest — so these mutators are only
 * invoked by an editor-or-above. A residual 403 (a stale role, a cold
 * deep-link race) still rejects the promise, which the caller surfaces as
 * an error toast via its own `catch`.
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
    /** True when the list query failed. */
    isError: boolean;
    /** The list query error, when present. */
    error: Error | null;
    /** Retries the list query without reloading the page. */
    refetch: () => Promise<unknown>;
    /**
     * Creates a label on the active project (POST `{ projectId, name, color? }`).
     * Resolves with the backend acknowledgement; the list re-fetches on
     * success via the mutation's default invalidation.
     */
    createLabel: (input: { name: string; color?: string }) => Promise<unknown>;
    /** True while the create mutation is in flight. */
    isCreating: boolean;
    /**
     * Updates an existing label (PUT `{ _id, name?, color? }`). Only the
     * `name` / `color` fields are writable server-side; `projectId` is
     * immutable. Resolves with the backend acknowledgement; the list
     * re-fetches on success.
     */
    updateLabel: (input: {
        _id: string;
        name?: string;
        color?: string;
    }) => Promise<unknown>;
    /** True while the update mutation is in flight. */
    isUpdating: boolean;
    /**
     * Removes a label by id (DELETE serialized to `?labelId=`). The
     * server cascade-strips the id from the project's tasks; the labels
     * list re-fetches on success.
     */
    removeLabel: (labelId: string) => Promise<unknown>;
    /** True while the delete mutation is in flight. */
    isRemoving: boolean;
}

const useLabels = (projectId: string | undefined): UseLabels => {
    const { data, isLoading, isError, error, refetch } = useReactQuery<
        ILabel[]
    >(
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

    const queryKey = getLabelsQueryKey(projectId);

    const { mutateAsync: create, isLoading: isCreating } =
        useReactMutation<unknown>(LABELS_ENDPOINT, "POST", queryKey);
    const { mutateAsync: update, isLoading: isUpdating } =
        useReactMutation<unknown>(LABELS_ENDPOINT, "PUT", queryKey);
    const { mutateAsync: remove, isLoading: isRemoving } =
        useReactMutation<unknown>(LABELS_ENDPOINT, "DELETE", queryKey);

    const createLabel = useCallback(
        (input: { name: string; color?: string }) =>
            create({ projectId, name: input.name, color: input.color }),
        [create, projectId]
    );

    const updateLabel = useCallback(
        (input: { _id: string; name?: string; color?: string }) =>
            update({ ...input }),
        [update]
    );

    const removeLabel = useCallback(
        (labelId: string) => remove({ labelId }),
        [remove]
    );

    return {
        labels: list,
        isLoading,
        isError,
        error,
        refetch,
        createLabel,
        isCreating,
        updateLabel,
        isUpdating,
        removeLabel,
        isRemoving
    };
};

export default useLabels;
