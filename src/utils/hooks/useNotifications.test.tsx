import { act, renderHook, waitFor } from "@testing-library/react";
import { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import useApi from "./useApi";
import useNotifications, {
    NOTIFICATIONS_ENDPOINT,
    NOTIFICATIONS_QUERY_KEY
} from "./useNotifications";

jest.mock("./useApi");

const mockedUseApi = useApi as jest.MockedFunction<typeof useApi>;

const createQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            mutations: {
                retry: false
            },
            queries: {
                gcTime: Infinity,
                retry: false
            }
        }
    });

const createWrapper = (queryClient: QueryClient) =>
    function Wrapper({ children }: { children: ReactNode }) {
        return (
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        );
    };

const buildNotification = (
    overrides: Partial<INotification> = {}
): INotification => ({
    _id: "ntf-1",
    userId: "u-1",
    kind: "mention",
    refId: "task-1",
    projectId: "proj-1",
    summary: "Alice mentioned you",
    isRead: false,
    createdAt: "2026-06-01T10:00:00.000Z",
    ...overrides
});

describe("useNotifications", () => {
    let apiMock: jest.MockedFunction<ReturnType<typeof useApi>>;

    beforeEach(() => {
        apiMock = jest.fn() as jest.MockedFunction<ReturnType<typeof useApi>>;
        mockedUseApi.mockReturnValue(apiMock);
    });

    it("exposes the canonical bare endpoint + query key", () => {
        // Mirrors the `useMembersList` convention: the endpoint is the bare
        // resource path (no `/api/v1/` prefix — `useApi` prepends it).
        expect(NOTIFICATIONS_ENDPOINT).toBe("notifications");
        expect(NOTIFICATIONS_QUERY_KEY).toEqual(["notifications"]);
    });

    it("fetches the caller's notifications via GET and populates the cache", async () => {
        const queryClient = createQueryClient();
        const notifications = [
            buildNotification({ _id: "ntf-1" }),
            buildNotification({ _id: "ntf-2", isRead: true })
        ];
        apiMock.mockResolvedValue(notifications);

        const { result } = renderHook(() => useNotifications(), {
            wrapper: createWrapper(queryClient)
        });

        await waitFor(() =>
            expect(result.current.notifications).toEqual(notifications)
        );

        // GET with no body — the backend never accepts a userId, so the
        // hook sends none.
        expect(apiMock).toHaveBeenCalledWith(NOTIFICATIONS_ENDPOINT, {
            data: {},
            method: "GET"
        });
        expect(queryClient.getQueryData(NOTIFICATIONS_QUERY_KEY)).toEqual(
            notifications
        );
    });

    it("derives unreadCount from the !isRead notifications", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue([
            buildNotification({ _id: "a", isRead: false }),
            buildNotification({ _id: "b", isRead: true }),
            buildNotification({ _id: "c", isRead: false })
        ]);

        const { result } = renderHook(() => useNotifications(), {
            wrapper: createWrapper(queryClient)
        });

        await waitFor(() => expect(result.current.unreadCount).toBe(2));
    });

    it("reports unreadCount 0 before the first load resolves", () => {
        const queryClient = createQueryClient();
        // Never resolves — the query stays pending.
        apiMock.mockReturnValue(new Promise(() => {}));

        const { result } = renderHook(() => useNotifications(), {
            wrapper: createWrapper(queryClient)
        });

        expect(result.current.notifications).toBeUndefined();
        expect(result.current.unreadCount).toBe(0);
    });

    it("markRead PUTs { _id } and invalidates the notifications query", async () => {
        const queryClient = createQueryClient();
        const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
        apiMock.mockResolvedValue([buildNotification({ _id: "ntf-1" })]);

        const { result } = renderHook(() => useNotifications(), {
            wrapper: createWrapper(queryClient)
        });
        await waitFor(() => expect(result.current.notifications).toBeDefined());

        // The mark-read endpoint returns a string acknowledgement; the
        // follow-up invalidation refetch returns the row as read (an
        // array) so the list query stays well-typed.
        apiMock.mockResolvedValueOnce("Notification updated");
        apiMock.mockResolvedValue([
            buildNotification({ _id: "ntf-1", isRead: true })
        ]);
        act(() => {
            result.current.markRead("ntf-1");
        });

        await waitFor(() =>
            expect(apiMock).toHaveBeenCalledWith("notifications", {
                data: { _id: "ntf-1" },
                method: "PUT"
            })
        );
        await waitFor(() =>
            expect(invalidateSpy).toHaveBeenCalledWith({
                queryKey: NOTIFICATIONS_QUERY_KEY
            })
        );
    });

    it("markRead is a no-op for an empty id (no PUT fired)", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValue([]);

        const { result } = renderHook(() => useNotifications(), {
            wrapper: createWrapper(queryClient)
        });
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        apiMock.mockClear();
        act(() => {
            result.current.markRead("");
        });

        // No PUT — the guard short-circuits before the mutation.
        expect(apiMock).not.toHaveBeenCalled();
    });

    it("markAllRead PUTs { markAll: true } and invalidates the query", async () => {
        const queryClient = createQueryClient();
        const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
        apiMock.mockResolvedValue([
            buildNotification({ _id: "a", isRead: false }),
            buildNotification({ _id: "b", isRead: false })
        ]);

        const { result } = renderHook(() => useNotifications(), {
            wrapper: createWrapper(queryClient)
        });
        await waitFor(() => expect(result.current.unreadCount).toBe(2));

        // PUT ack, then the invalidation refetch returns both rows read.
        apiMock.mockResolvedValueOnce("Notification updated");
        apiMock.mockResolvedValue([
            buildNotification({ _id: "a", isRead: true }),
            buildNotification({ _id: "b", isRead: true })
        ]);
        act(() => {
            result.current.markAllRead();
        });

        await waitFor(() =>
            expect(apiMock).toHaveBeenCalledWith("notifications", {
                data: { markAll: true },
                method: "PUT"
            })
        );
        await waitFor(() =>
            expect(invalidateSpy).toHaveBeenCalledWith({
                queryKey: NOTIFICATIONS_QUERY_KEY
            })
        );
    });

    it("re-fetches the list after a mark-read invalidation (unread clears)", async () => {
        const queryClient = createQueryClient();
        apiMock.mockResolvedValueOnce([
            buildNotification({ _id: "ntf-1", isRead: false })
        ]);

        const { result } = renderHook(() => useNotifications(), {
            wrapper: createWrapper(queryClient)
        });
        await waitFor(() => expect(result.current.unreadCount).toBe(1));

        // The PUT acks, then the invalidation triggers a GET that now
        // returns the row as read.
        apiMock.mockResolvedValueOnce("Notification updated");
        apiMock.mockResolvedValueOnce([
            buildNotification({ _id: "ntf-1", isRead: true })
        ]);
        act(() => {
            result.current.markRead("ntf-1");
        });

        await waitFor(() => expect(result.current.unreadCount).toBe(0));
    });
});
