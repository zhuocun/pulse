import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { isOptimisticPlaceholderId } from "../optimisticClientId";

import { NOTIFICATIONS_QUERY_KEY } from "./useNotifications";
import useReactMutation from "./useReactMutation";
import useReactQuery from "./useReactQuery";

/**
 * Task-comments data hook (M4 — backend Collaboration feature).
 *
 * Mirrors the thin REST-resource convention used by `useLabels` /
 * `useNotifications`: a single exported endpoint string + matching
 * per-task query key, a `useReactQuery` read for the thread, and
 * `useReactMutation` writes for create / edit / delete. The endpoint
 * string is the bare resource path (`"comments"`, no `/api/v1/` prefix)
 * exactly like `"labels"`, `"tasks"`, and `"notifications"` — `useApi`
 * prepends `environment.apiBaseUrl` (`/api/v1`) so the same-origin
 * session cookie rides every request.
 *
 * Backend contract:
 *   - `GET /api/v1/comments/?taskId=` → the task's `IComment[]`,
 *     oldest-first.
 *   - `POST /api/v1/comments/` body `{ taskId, body, mentions? }` →
 *     `"Comment created"`. `projectId` is derived server-side from the
 *     task; `mentions` is an array of userId strings (the server does
 *     not parse `@name` from the body — the FE passes explicit ids).
 *   - `PUT /api/v1/comments/` body `{ _id, body }` → `"Comment updated"`.
 *     Only `body` is writable; mentions are not re-processed on edit.
 *   - `DELETE /api/v1/comments/?commentId=` → `"Comment deleted"`.
 *
 * The query is keyed per-task (`["comments", { taskId }]`) so one task's
 * thread never reads another's, and a write invalidates exactly that
 * task's list (the `useReactMutation` default). The list query is
 * disabled until a real `taskId` is known — an optimistic placeholder id
 * (a not-yet-persisted task) never has server comments, so we skip the
 * `GET /comments/?taskId=tmp-…` that would 404.
 */
export const COMMENTS_ENDPOINT = "comments";

export const getCommentsQueryKey = (taskId: string | undefined) =>
    ["comments", { taskId }] as const;

/**
 * Comments are conversational, so they refresh more eagerly than the
 * 5-minute labels / members rosters. A short window still serves a
 * just-fetched thread from cache on a re-open without a refetch storm,
 * while the create / edit / delete invalidations keep the list honest
 * after every write.
 */
export const COMMENTS_STALE_TIME_MS = 30 * 1000;

interface UseComments {
    /** The task's comments, oldest-first. `undefined` until first load. */
    comments: IComment[] | undefined;
    /** True while the list query is in flight. */
    isLoading: boolean;
    /** True when the list query failed (drives the load-error banner). */
    isError: boolean;
    /**
     * Creates a comment on the task (POST `{ taskId, body, mentions? }`).
     * `mentions` is only sent when non-empty. When ≥1 mention is sent, the
     * notifications query is also invalidated so the bell badge picks up
     * the freshly-produced `mention` notifications.
     */
    createComment: (input: {
        body: string;
        mentions?: string[];
    }) => Promise<unknown>;
    /** True while the create mutation is in flight. */
    isCreating: boolean;
    /** Edits a comment's body (PUT `{ _id, body }`). Author-only server-side. */
    editComment: (input: { _id: string; body: string }) => Promise<unknown>;
    /** True while the edit mutation is in flight. */
    isEditing: boolean;
    /** Deletes a comment by id (DELETE `?commentId=`). */
    deleteComment: (commentId: string) => Promise<unknown>;
    /** True while the delete mutation is in flight. */
    isDeleting: boolean;
}

const useComments = (taskId: string | undefined): UseComments => {
    const queryClient = useQueryClient();
    const enabled = Boolean(taskId) && !isOptimisticPlaceholderId(taskId);

    const { data, isLoading, isError } = useReactQuery<IComment[]>(
        COMMENTS_ENDPOINT,
        { taskId },
        undefined,
        undefined,
        undefined,
        enabled,
        { staleTime: COMMENTS_STALE_TIME_MS }
    );

    /*
     * Normalize to a guaranteed `IComment[] | undefined`. The list
     * endpoint returns an array, but the query cache is shared with the
     * write mutation keys — a stray non-array payload (the write-endpoint
     * string ack, a malformed / errored response, or a test's global
     * fetch stub) must not crash the `.map` consumers in the thread. A
     * non-array resolves to `undefined` ("no data yet") rather than
     * throwing.
     */
    const list = Array.isArray(data) ? data : undefined;

    const queryKey = getCommentsQueryKey(taskId);

    const { mutateAsync: create, isLoading: isCreating } =
        useReactMutation<unknown>(COMMENTS_ENDPOINT, "POST", queryKey);
    const { mutateAsync: edit, isLoading: isEditing } =
        useReactMutation<unknown>(COMMENTS_ENDPOINT, "PUT", queryKey);
    const { mutateAsync: remove, isLoading: isDeleting } =
        useReactMutation<unknown>(COMMENTS_ENDPOINT, "DELETE", queryKey);

    const createComment = useCallback(
        async (input: { body: string; mentions?: string[] }) => {
            const mentions = input.mentions ?? [];
            const hasMentions = mentions.length > 0;
            const result = await create({
                taskId,
                body: input.body,
                ...(hasMentions ? { mentions } : {})
            });
            // A mention produces a server-side notification for each valid
            // mentioned member, so the bell badge must re-derive its unread
            // count. The create's own success already invalidated the
            // comments thread; this is the cross-resource refresh the
            // comments cache key cannot reach. Skip it when no mention was
            // sent — there's nothing new for the bell to show.
            if (hasMentions) {
                queryClient.invalidateQueries({
                    queryKey: NOTIFICATIONS_QUERY_KEY
                });
            }
            return result;
        },
        [create, queryClient, taskId]
    );

    const editComment = useCallback(
        (input: { _id: string; body: string }) =>
            edit({ _id: input._id, body: input.body }),
        [edit]
    );

    const deleteComment = useCallback(
        (commentId: string) => remove({ commentId }),
        [remove]
    );

    return {
        comments: list,
        isLoading,
        isError,
        createComment,
        isCreating,
        editComment,
        isEditing,
        deleteComment,
        isDeleting
    };
};

export default useComments;
