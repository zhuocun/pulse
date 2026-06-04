import { useCallback } from "react";

import useReactMutation from "./useReactMutation";
import useReactQuery from "./useReactQuery";

/**
 * Notifications data hook (Phase 6 — backend Notifications feature).
 *
 * Mirrors the thin REST-resource convention used by `useMembersList`:
 * a single exported endpoint string + matching query key, a
 * `useReactQuery` read for the list, and a `useReactMutation` PUT for
 * the mark-read writes. The endpoint string is the bare resource path
 * (`"notifications"`, no `/api/v1/` prefix) exactly like `"users/members"`,
 * `"tasks"`, and `"projects"` — `useApi` prepends `environment.apiBaseUrl`
 * (`/api/v1`) so the same-origin session cookie rides every request.
 *
 * Backend contract:
 *   - `GET /api/v1/notifications/`  → the CALLER's `INotification[]`
 *     (newest first; the server never accepts a userId so a client
 *     cannot read anyone else's inbox).
 *   - `PUT /api/v1/notifications/` body `{ _id }`        → mark one read.
 *   - `PUT /api/v1/notifications/` body `{ markAll: true }` → mark all read.
 *
 * Both mutations invalidate the notifications query on success (the
 * `useReactMutation` default), so the list + `unreadCount` re-fetch and
 * settle to the server truth after a write.
 */
export const NOTIFICATIONS_ENDPOINT = "notifications";
export const NOTIFICATIONS_QUERY_KEY = [NOTIFICATIONS_ENDPOINT] as const;

interface UseNotifications {
    /** The caller's notifications, newest first. `undefined` until first load. */
    notifications: INotification[] | undefined;
    /** Count of `!isRead` notifications — drives the bell badge. */
    unreadCount: number;
    /** True while the list query is in flight. */
    isLoading: boolean;
    /** Marks a single notification read by id (PUT `{ _id }`). */
    markRead: (id: string) => void;
    /** Marks every unread notification read (PUT `{ markAll: true }`). */
    markAllRead: () => void;
    /** True while either mark-read mutation is in flight. */
    isMutating: boolean;
}

const useNotifications = (): UseNotifications => {
    const { data, isLoading } = useReactQuery<INotification[]>(
        NOTIFICATIONS_ENDPOINT
    );

    /*
     * Normalize to a guaranteed `INotification[] | undefined`. The list
     * endpoint returns an array, but the query cache is shared with the
     * `PUT` mutation key — a stray non-array payload (the mark-read string
     * ack, a malformed / errored response, or a test's global fetch stub)
     * must not crash the `.filter` / `.map` consumers. A non-array resolves
     * to `undefined` ("no data yet") rather than throwing.
     */
    const list = Array.isArray(data) ? data : undefined;

    /*
     * Both writes target the same endpoint + query key. The default
     * `useReactMutation` `onSuccess` invalidates `NOTIFICATIONS_QUERY_KEY`,
     * so the list re-fetches and `unreadCount` re-derives from the
     * server's post-write truth. No optimistic callback: the mark-read
     * round-trip is cheap and the invalidation keeps the cache honest.
     */
    const { mutate: mutateRead, isLoading: readLoading } =
        useReactMutation<string>(
            "notifications",
            "PUT",
            NOTIFICATIONS_QUERY_KEY
        );

    const markRead = useCallback(
        (id: string) => {
            if (!id) return;
            mutateRead({ _id: id });
        },
        [mutateRead]
    );

    const markAllRead = useCallback(() => {
        mutateRead({ markAll: true });
    }, [mutateRead]);

    const unreadCount = (list ?? []).filter(
        (notification) => !notification.isRead
    ).length;

    return {
        notifications: list,
        unreadCount,
        isLoading,
        markRead,
        markAllRead,
        isMutating: readLoading
    };
};

export default useNotifications;
